import {
  IsString,
  Matches,
  MaxLength,
  MinLength,
  IsEnum,
  IsOptional,
  IsInt,
  Min,
} from 'class-validator';
export class CreateUserDto {
  @IsString() @Matches(/^[a-zA-Z0-9._-]{1,80}$/) username!: string;
  @IsString() @Matches(/\S/) @MaxLength(160) displayName!: string;
  @IsString() @MinLength(12) @MaxLength(256) password!: string;
  @IsEnum([
    'super_admin',
    'event_manager',
    'ticket_manager',
    'checkin_supervisor',
    'scanner',
  ])
  orgRole!: string;
  @IsOptional() @IsInt() @Min(1) eventId?: number;
}
export class UpdateUserDto {
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(160) displayName?: string;
  @IsOptional()
  @IsEnum([
    'super_admin',
    'event_manager',
    'ticket_manager',
    'checkin_supervisor',
    'scanner',
  ])
  orgRole?: string;
}
export class RoleDto {
  @IsEnum([
    'super_admin',
    'event_manager',
    'ticket_manager',
    'checkin_supervisor',
    'scanner',
  ])
  role!: string;
}
