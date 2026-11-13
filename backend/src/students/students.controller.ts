import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  ParseIntPipe,
  UploadedFile,
  UseInterceptors,
  StreamableFile,
  BadRequestException,
  Header,
  HttpCode,
  Query,
} from '@nestjs/common';
import { RegistrationUploadInterceptor } from './registration-upload.js';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../common/request.js';
import { StudentsService } from './students.service.js';
@ApiTags('students-and-invitations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('events/:eventId')
export class StudentsController {
  constructor(private readonly service: StudentsService) {}
  @Get('registrations/page') page(@Param('eventId',ParseIntPipe) e:number,@Query() q:unknown,@Req() r:AuthenticatedRequest){return this.service.page(e,r,q);}
  @Get('registrations') overview(
    @Param('eventId', ParseIntPipe) e: number,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.overview(e, r);
  }
  @Get('students') students(
    @Param('eventId', ParseIntPipe) e: number,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.list(e, r, 'students');
  }
  @Get('guests') guests(
    @Param('eventId', ParseIntPipe) e: number,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.list(e, r, 'guests');
  }
  @Get('students/:id') student(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.one(e, id, r, 'students');
  }
  @Get('guests/:id') guest(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.one(e, id, r, 'guests');
  }
  @Post('students') createStudent(
    @Param('eventId', ParseIntPipe) e: number,
    @Body() body: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.save(e, undefined, 'student', body, r);
  }
  @Patch('students/:id') updateStudent(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.save(e, id, 'student', body, r);
  }
  @Post('guests') createGuest(
    @Param('eventId', ParseIntPipe) e: number,
    @Body() body: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.save(e, undefined, 'guest', body, r);
  }
  @Patch('guests/:id') updateGuest(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.save(e, id, 'guest', body, r);
  }
  @Get('students/:id/cancellation-impact') impact(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.impact(e, id, r);
  }
  @Post('students/:id/cancel')
  @HttpCode(200)
  cancelStudent(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.cancel(e, id, 'student', body, r);
  }
  @Delete('students/:id') deleteStudent(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.cancel(e, id, 'student', body, r);
  }
  @Post('guests/:id/cancel')
  @HttpCode(200)
  cancelGuest(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.cancel(e, id, 'guest', body, r);
  }
  @Delete('guests/:id') deleteGuest(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.cancel(e, id, 'guest', body, r);
  }
  @Get('registration-fields') async fields(
    @Param('eventId', ParseIntPipe) e: number,
    @Req() r: AuthenticatedRequest,
  ) {
    return (await this.service.overview(e, r)).fields;
  }
  @Post('registration-fields') createField(
    @Param('eventId', ParseIntPipe) e: number,
    @Body() body: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.saveField(e, undefined, body, r);
  }
  @Patch('registration-fields/:id') updateField(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.saveField(e, id, body, r);
  }
  @Delete('registration-fields/:id') deactivateField(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.saveField(e, id, { active: false }, r);
  }
  @Get('invitation-limits') async limits(
    @Param('eventId', ParseIntPipe) e: number,
    @Req() r: AuthenticatedRequest,
  ) {
    return (await this.service.overview(e, r)).limits;
  }
  @Patch('invitation-limits') saveLimits(
    @Param('eventId', ParseIntPipe) e: number,
    @Body() body: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.saveLimits(e, body, r);
  }
  @Get('registration-template')
  @Header('Cache-Control', 'no-store')
  async template(
    @Param('eventId', ParseIntPipe) e: number,
    @Req() r: AuthenticatedRequest,
  ) {
    return new StreamableFile(await this.service.template(e, r), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="students-guests.xlsx"',
    });
  }
  @Post('registration-import/preview')
  @UseInterceptors(RegistrationUploadInterceptor)
  preview(
    @Param('eventId', ParseIntPipe) e: number,
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
    @Body() body: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.importFile(e, this.file(file), body, false, r);
  }
  @Post('registration-import/commit')
  @UseInterceptors(RegistrationUploadInterceptor)
  commit(
    @Param('eventId', ParseIntPipe) e: number,
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
    @Body() body: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.importFile(e, this.file(file), body, true, r);
  }
  private file(file: { buffer: Buffer; originalname: string } | undefined) {
    if (!file?.buffer || !file.originalname.toLowerCase().endsWith('.xlsx'))
      throw new BadRequestException(
        'Upload an .xlsx file using the event template.',
      );
    return file.buffer;
  }
}
