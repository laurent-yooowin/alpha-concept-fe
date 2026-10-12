import { Transform } from 'class-transformer';
import { IsIn } from 'class-validator';
import { PREVENTION_CONSTRUCTION_PHASES, PreventionConstructionPhase } from '../prevention-phase';

export class PreventionPhaseValidationDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsIn(PREVENTION_CONSTRUCTION_PHASES)
  phase: PreventionConstructionPhase;
}
