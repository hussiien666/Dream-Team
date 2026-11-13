import { Controller, Get, Post, Patch, Delete, Param, Body, Req, ParseIntPipe, HttpCode, HttpStatus, UseGuards, UseInterceptors, UploadedFile, StreamableFile, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { AuthenticatedRequest as Request } from '../common/request.js';
import { AttendeesService } from './attendees.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { AttendeeImportService } from './attendee-import.service.js';
import { RegistrationUploadInterceptor } from '../students/registration-upload.js';

@ApiTags('attendees')
@ApiBearerAuth()
@Controller('events/:eventId/attendees')
@UseGuards(JwtAuthGuard)
export class AttendeesController {
  constructor(private readonly attendeesService: AttendeesService,private readonly imports:AttendeeImportService) {}

  @Get() findAll(@Param('eventId', ParseIntPipe) eventId: number, @Req() req: Request) {
    return this.attendeesService.findAll(eventId, req['user'].id, req['orgRole'], req['orgId']);
  }
  @Get('independent') independent(@Param('eventId',ParseIntPipe) e:number,@Req() r:Request){return this.attendeesService.findAll(e,r.user.id,r.orgRole,r.orgId,true);}
  @Get('template') async template(@Param('eventId',ParseIntPipe) e:number,@Req() r:Request){return new StreamableFile(await this.imports.template(e,r),{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',disposition:'attachment; filename="attendees.xlsx"'});}
  @Get('export/:format') async exportFile(@Param('eventId',ParseIntPipe) e:number,@Param('format') f:string,@Query() q:unknown,@Req() r:Request){return new StreamableFile(await this.imports.exportFile(e,f,q,r),{type:f==='csv'?'text/csv; charset=utf-8':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',disposition:`attachment; filename="attendees.${f==='csv'?'csv':'xlsx'}"`});}
  @Post('import/preview') @UseInterceptors(RegistrationUploadInterceptor)
  preview(@Param('eventId',ParseIntPipe) e:number,@UploadedFile() f:{buffer:Buffer;originalname:string}|undefined,@Body() b:unknown,@Req() r:Request){return this.imports.importFile(e,f,b,false,r);}
  @Post('import/columns') @UseInterceptors(RegistrationUploadInterceptor)
  columns(@Param('eventId',ParseIntPipe) e:number,@UploadedFile() f:{buffer:Buffer;originalname:string}|undefined,@Req() r:Request){return this.imports.columns(e,f,r);}
  @Post('import/commit') @UseInterceptors(RegistrationUploadInterceptor)
  commit(@Param('eventId',ParseIntPipe) e:number,@UploadedFile() f:{buffer:Buffer;originalname:string}|undefined,@Body() b:unknown,@Req() r:Request){return this.imports.importFile(e,f,b,true,r);}

  @Get(':id') findOne(@Param('eventId', ParseIntPipe) eventId: number, @Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.attendeesService.findOne(eventId, id, req['user'].id, req['orgRole'], req['orgId']);
  }

  @Post() create(@Param('eventId', ParseIntPipe) eventId: number, @Body() dto: any, @Req() req: Request) {
    return this.attendeesService.create(eventId, dto, req['user'].id, req['orgRole'], req['orgId']);
  }

  @Patch(':id') update(@Param('eventId', ParseIntPipe) eventId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: any, @Req() req: Request) {
    return this.attendeesService.update(eventId, id, dto, req['user'].id, req['orgRole'], req['orgId']);
  }

  @Post(':id/cancel') @HttpCode(HttpStatus.NO_CONTENT) cancel(@Param('eventId', ParseIntPipe) eventId: number, @Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.attendeesService.cancel(eventId, id, req['user'].id, req['orgRole'], req['orgId']);
  }

  @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) delete(@Param('eventId', ParseIntPipe) eventId: number, @Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.attendeesService.delete(eventId, id, req['user'].id, req['orgRole'], req['orgId']);
  }
}
