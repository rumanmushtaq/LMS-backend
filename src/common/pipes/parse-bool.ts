import { Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class ParseBoolPipe implements PipeTransform {
  transform(value: string): boolean {
    return value?.toLowerCase() === 'true';
  }
}
