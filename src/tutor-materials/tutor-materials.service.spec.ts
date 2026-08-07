import { Test, TestingModule } from '@nestjs/testing';
import { TutorMaterialsService } from './tutor-materials.service';

describe('TutorMaterialsService', () => {
  let service: TutorMaterialsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TutorMaterialsService],
    }).compile();

    service = module.get<TutorMaterialsService>(TutorMaterialsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
