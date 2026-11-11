import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(256)
  currentPassword: string;

  @ApiProperty()
  @IsString()
  @MinLength(12)
  @MaxLength(256)
  newPassword: string;
}
