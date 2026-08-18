import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PlatformSettings,
  PlatformSettingsDocument,
  RevenueArea,
} from '../schemas/platform-settings.schema';

const SETTINGS_KEY = 'default';

export interface UpdateSettingsInput {
  defaultCommissionPercent?: number;
  commissions?: { area: RevenueArea; percent: number }[];
  currency?: string;
  enabledProviders?: string[];
}

/**
 * Admin-editable platform settings, currently the commission rates and which
 * payment methods are offered.
 *
 * Reads go through `get()`, which creates the single settings row on first use
 * so a fresh install has working defaults rather than throwing.
 */
@Injectable()
export class PlatformSettingsService {
  constructor(
    @InjectModel(PlatformSettings.name)
    private readonly settingsModel: Model<PlatformSettingsDocument>,
  ) {}

  async get(): Promise<PlatformSettingsDocument> {
    const existing = await this.settingsModel.findOne({ key: SETTINGS_KEY });
    if (existing) return existing;

    return this.settingsModel.create({ key: SETTINGS_KEY });
  }

  /**
   * Commission for one area, falling back to the default rate.
   *
   * Returning the default rather than throwing matters: a new revenue area
   * must not be able to take payments at 0% commission just because nobody
   * has configured it yet.
   */
  async commissionPercentFor(area: RevenueArea): Promise<number> {
    const settings = await this.get();
    const configured = settings.commissions.find((c) => c.area === area);
    return configured?.percent ?? settings.defaultCommissionPercent;
  }

  async currency(): Promise<string> {
    return (await this.get()).currency;
  }

  async update(
    input: UpdateSettingsInput,
    adminId: string,
  ): Promise<PlatformSettingsDocument> {
    const settings = await this.get();

    if (input.defaultCommissionPercent !== undefined) {
      settings.defaultCommissionPercent = input.defaultCommissionPercent;
    }
    if (input.currency !== undefined) {
      settings.currency = input.currency.toUpperCase();
    }
    if (input.enabledProviders !== undefined) {
      settings.enabledProviders = input.enabledProviders;
    }
    if (input.commissions !== undefined) {
      // Replace wholesale: the admin screen submits the full table, and
      // merging would leave a removed area silently keeping its old rate.
      settings.commissions = input.commissions;
      settings.markModified('commissions');
    }

    settings.updatedBy = new Types.ObjectId(adminId);
    await settings.save();

    return settings;
  }
}
