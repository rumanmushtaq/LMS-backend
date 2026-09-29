# Class chat: file attachments and emoji

**Date:** 2026-09-12
**Status:** Approved, not yet implemented

## Problem

During a live class, the only thing a tutor or student can put in the Q&A panel is
plain text. A tutor cannot hand out the worksheet the lesson is built around, and a
student cannot show the problem they are stuck on. Both work around it by reading
URLs aloud or pasting links, which is exactly the moment a class stalls.

The panel is also the one chat surface in the product with no emoji picker. The
floating DM widget, the `/chat` page and the admin moderation view all have one;
`LiveQnAPanel` was written separately and never got it.

## Scope

`LiveQnAPanel` and `useLiveClass` only.

That single component is rendered by both `TutorLiveClassView` and
`StudentLiveClassView`, and the backend applies no role check when sending — the
gate is `assertParticipant`, which both tutor and enrolled students pass. So
tutor-to-student and student-to-tutor both fall out of one implementation.

Out of scope: the DM widget, the `/chat` page, and the admin moderation view. The
shared pieces this introduces (the upload endpoint, the schema field, the
attachment renderer) are built so those surfaces can adopt them later without
rework, but none of them are touched here.

## Decisions

**One file per message.** Not a multi-select. Keeps the composer, the send path
and the bubble simple, and matches how attachments are actually used in a class.

**Upload over REST, then send the URL over the socket.** Every existing upload in
this codebase is two-step: `POST` the file, get a URL back, save the URL on the
owning document. Pushing bytes through the Socket.IO gateway instead would bypass
multer, inflate the message payload past the existing 5000-character guard, and
give no upload progress. Two-step it is.

**Accepted types:** PDF, doc/docx, ppt/pptx, xls/xlsx, and png/jpg/webp. Images
are included because a photo of handwritten work or a screenshot of an error is
the most common thing a student has to show.

**Size cap: 25MB.** Generous for chat and well under the 100MB the tutor-materials
upload already allows.

**Storage: ImageKit, public CDN URL.** Same as every other upload in the product
(tutor materials, KYC documents, tax forms). The URL is unguessable but not
access-controlled. Diverging here — an authenticated download proxy — would be new
infrastructure inconsistent with the rest of the app, and would not be worth much
while student KYC documents are served the same way. Worth revisiting product-wide,
not in this change.

## Backend

### 1. `Message` schema

Add a nested, optional `attachment`:

```ts
{ url: string; name: string; mimeType: string; size: number }
```

Relax `content` from `required: true` to `default: ''`. Today an attachment with
no caption cannot be saved at all — Mongoose rejects it before it reaches the
gateway.

### 2. `POST /chat/upload`

New endpoint on `ChatController` (already `JwtAuthGuard`-guarded).

- `FileInterceptor('file', { limits: { fileSize: 25MB } })`
- Takes `conversationId` in the body and runs `assertParticipant` on it. Without
  this the endpoint is anonymous file hosting for anyone with a valid login.
- Validates the MIME allowlist against **both** the reported mimetype and the file
  extension. The mimetype is client-supplied and trivially spoofed.
- Delegates to the existing `UploadService.uploadFile(file, 'chat-attachments')`.
- Returns `{ url, name, mimeType, size }`.

No allowlist or size validation exists anywhere in the backend today — `fileFilter`,
`ParseFilePipe` and `FileTypeValidator` appear nowhere — so this is built from
scratch rather than copied.

### 3. Gateway `deliverMessage`

- Accept `attachment` on the `sendMessage` payload.
- Invert the empty check: reject only when there is **neither** text nor an
  attachment. It currently rejects any empty `content`.
- Re-validate the attachment server-side: the shape (all four fields present,
  correct types, name and URL length-capped) and that `url` starts with the
  configured `imagekit.urlEndpoint`. The client sends back a URL it was given,
  and nothing stops a modified client sending a different one — without the
  origin check, any message could carry an arbitrary link rendered as a
  trustworthy-looking file card.
- `saveMessage` takes the attachment through to the document.
- Notification body for a caption-less attachment: `📎 <filename>`, since
  `notificationsService.create` stores `message.content` verbatim and would
  otherwise write an empty notification.

## Frontend

### 4. `useLiveClass`

`sendMessage(content, attachment?)`; `LiveMessage` gains the optional `attachment`.

No optimistic-send changes needed. This hook dedupes purely on `_id` via `seenIds`
and renders only what the server echoes back — unlike the DM surfaces, whose
`mergeMessage` matches an optimistic placeholder by content equality and would
have broken on attachment-only messages.

### 5. `LiveQnAPanel`

Composer gains two buttons:

- **Paperclip** → hidden file input. On pick, the file uploads immediately and
  shows as a chip with the filename, a progress indicator and a remove `×`. Send
  is enabled when there is either text or a staged attachment.
- **Smile** → `emoji-picker-react`, already a dependency and already used by the
  three other chat surfaces. It goes in the existing Radix
  `components/ui/popover.tsx` rather than the hand-rolled absolutely-positioned
  div the DM surfaces use: this panel is 360px wide inside a fixed-height column,
  and an unmanaged div overflows it. Reuses `insertAtCaret` and
  `shouldSendOnKeyDown` from `lib/chat/composer.ts`, which exist specifically to
  keep emoji and IME composition from sending half-composed messages.

### 6. `MessageAttachment`

New component: a file card (type icon, filename, size, download link) for
documents, an inline thumbnail for images. Kept standalone so the DM surfaces can
render attachments later by importing it.

## Testing

- Backend unit: the MIME allowlist rejects a spoofed mimetype and a disallowed
  extension; `assertParticipant` rejects a non-participant uploading to a room;
  `deliverMessage` accepts attachment-without-text and still rejects
  neither-text-nor-attachment.
- Manual E2E in a live class, using the existing probe tutor/student accounts:
  tutor sends a PDF and a student downloads it, a student sends an image and the
  tutor sees the thumbnail, emoji insert lands at the caret rather than the end.

## Known gaps

The admin moderation view renders raw `{msg.content}`, so an attachment-only
message appears blank there. It needs the same `MessageAttachment` treatment in a
follow-up; it is a separate app (`admin/`) on a separate branch.
