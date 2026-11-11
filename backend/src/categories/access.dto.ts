import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsBoolean,
  MaxLength,
  Matches,
  IsNumber,
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';
export class CreateCategoryDto {
  @IsString() @Matches(/\S/) @MaxLength(120) name!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,40}$/) code!: string;
  @IsOptional() @IsString() @MaxLength(3000) description?: string;
  @IsOptional() @IsString() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string;
  @IsInt() @Min(1) @Max(2147483647) allocation!: number;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) maxPerAttendee?: number;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  price?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}
export class CreateEntranceDto {
  @IsString() @Matches(/\S/) @MaxLength(120) name!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,40}$/) code!: string;
  @IsOptional() @IsString() @MaxLength(3000) description?: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsString() @MaxLength(3000) instructions?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  categoryIds?: number[];
}
export class UpdateEntranceDto extends PartialType(CreateEntranceDto) {}
