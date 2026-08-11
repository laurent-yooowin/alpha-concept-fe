import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { UploadModule } from '../upload/upload.module';
import { CustomPromptModule } from '../custom-prompts/custom-prompt.module';

@Module({
  imports: [UploadModule, CustomPromptModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
