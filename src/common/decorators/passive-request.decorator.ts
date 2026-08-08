import { SetMetadata } from '@nestjs/common';

export const IS_PASSIVE_REQUEST_KEY = 'isPassiveRequest';

/**
 * Marks an endpoint as a background/passive request.
 *
 * Passive requests still require a valid, non-idle session — they are fully
 * authenticated — but they do **not** slide `lastActivityAt`. Without this, any
 * polling loop, heartbeat or analytics beacon would keep a session alive
 * forever on a machine nobody is sitting at, which defeats the idle timeout.
 *
 * Apply it to anything the client fires on a timer rather than in response to a
 * deliberate user action.
 *
 * @example
 * ```ts
 * @PassiveRequest()
 * @Get('unread-count')
 * getUnreadCount() { ... }
 * ```
 */
export const PassiveRequest = () => SetMetadata(IS_PASSIVE_REQUEST_KEY, true);
