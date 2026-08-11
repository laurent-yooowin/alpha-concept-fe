import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Visit } from '../visits/visit.entity';
import { CustomPromptController } from './custom-prompt.controller';
import { CustomPrompt } from './custom-prompt.entity';
import { CustomPromptService } from './custom-prompt.service';

@Module({
  imports: [TypeOrmModule.forFeature([CustomPrompt, Visit])],
  controllers: [CustomPromptController],
  providers: [CustomPromptService],
  exports: [CustomPromptService],
})
export class CustomPromptModule {}
