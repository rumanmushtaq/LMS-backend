import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type PlatformSettingsDocument = HydratedDocument<PlatformSettings>;

/**
 * Where the money came from. Commission is configured per area, because the
 * economics differ: physical goods carry stock and shipping cost, digital
 * downloads are pure margin, live classes are the tutor's time.
 */
export enum RevenueArea {
  SHOP = 'shop',
  MATERIALS = 'materials',
  CLASSES = 'classes',
}

/** Commission for one revenue area. */
export class AreaCommission {
  @ApiProperty({ enum: RevenueArea })
  @Prop({ type: String, enum: RevenueArea, required: true })
  area: RevenueArea;

  @ApiProperty({ description: 'Percentage the platform keeps, 0-100' })
  @Prop({ type: Number, required: true, min: 0, max: 100 })
  percent: number;
}

/**
 * A single settings document that admins edit.
 *
 * Deliberately one row (`key: 'default'`) rather than env vars: the rates are a
 * business lever the finance side changes, and requiring a redeploy to change a
 * commission is how platforms end up with the rate hard-coded in three places.
 */
@Schema({ timestamps: true })
export class PlatformSettings {
  @ApiProperty({
    description: 'Always "default" — this collection holds one document',
  })
  @Prop({ type: String, required: true, unique: true, default: 'default' })
  key: string;

  @ApiProperty({ description: 'Commission percentage per revenue area' })
  @Prop({ type: [AreaCommission], default: [] })
  commissions: AreaCommission[];

  @ApiProperty({ description: 'Fallback when an area has no explicit rate' })
  @Prop({ type: Number, default: 15, min: 0, max: 100 })
  defaultCommissionPercent: number;

  @ApiProperty({ description: 'Currency all prices are charged in' })
  @Prop({ type: String, default: 'USD' })
  currency: string;

  @ApiProperty({
    description:
      'Payment provider ids offered to buyers, in display order (e.g. ["stripe","pse"])',
  })
  @Prop({ type: [String], default: ['stripe'] })
  enabledProviders: string[];

  @ApiProperty({ description: 'Admin who last changed these settings' })
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy: Types.ObjectId | null;
}

export const PlatformSettingsSchema =
  SchemaFactory.createForClass(PlatformSettings);
