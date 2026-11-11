import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty()
  @IsString()
  @MinLength(1) @MaxLength(80)
  username: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password: string;
}
