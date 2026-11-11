import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsPositive,
  IsDateString,
  IsEnum,
  MaxLength,
  MinLength,
  Matches,
  Max,
  IsBoolean,
  ValidateNested,
  IsHexColor,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export enum EventStatusDto {
  Draft = 'Draft',
  Upcoming = 'Upcoming',
  Active = 'Active',
  Published = 'Published',
  Ongoing = 'Ongoing',
  Completed = 'Completed',
  Cancelled = 'Cancelled',
}

export class CreateEventDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  organization?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  eventType?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) venue: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  building?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  instructions?: string;
  @ApiProperty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  eventDate: string;
  @ApiProperty() @IsDateString() startsAt: string;
  @ApiProperty() @IsDateString() endsAt: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  distributionStart?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() distributionEnd?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  registrationDeadline?: string;
  @ApiProperty() @IsInt() @IsPositive() @Max(2147483647) capacity: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(2147483647)
  maxTickets?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(EventStatusDto)
  status?: EventStatusDto;
}

export class UpdateEventDto extends PartialType(CreateEventDto) {}

/** Stored per-event configuration. Feature consumers are introduced in later stages. */
export class EventConfigurationDto {
  @IsOptional() @IsBoolean() automaticTicketGeneration?: boolean;
  @IsOptional() @IsInt() @IsPositive() defaultCategoryId?: number | null;
  @IsOptional() @IsInt() @IsPositive() @Max(2147483647) guestLimit?: number;
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(2147483647)
  perStudentLimit?: number;
  @IsOptional() @IsBoolean() studentTicketEnabled?: boolean;
  @IsOptional() @IsBoolean() directGuestDelivery?: boolean;
  @IsOptional() @IsBoolean() studentCopies?: boolean;
  @IsOptional() @IsEnum(['admin', 'automatic']) transferApproval?:
    'admin' | 'automatic';
  @IsOptional() @IsDateString() transferDeadline?: string | null;
  @IsOptional() @IsHexColor() primaryColor?: string;
  @IsOptional() @IsHexColor() accentColor?: string;
  @IsOptional() @IsBoolean() notifyGuestChanges?: boolean;
  @IsOptional() @IsBoolean() notifyEmailFailures?: boolean;
}
export class UpdateEventSettingsDto {
  @ValidateNested()
  @Type(() => EventConfigurationDto)
  settings!: EventConfigurationDto;
}
