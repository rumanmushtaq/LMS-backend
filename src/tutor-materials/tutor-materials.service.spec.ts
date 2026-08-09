import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { TutorMaterialsService } from './tutor-materials.service';
import { TutorMaterial } from './schemas/tutor-material.schema';
import { MaterialPurchase } from './schemas/material-purchase.schema';

describe('TutorMaterialsService', () => {
  let service: TutorMaterialsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TutorMaterialsService,
        // The service only needs the injection tokens satisfied to construct;
        // per-method behavior is exercised against these mocks as tests grow.
        { provide: getModelToken(TutorMaterial.name), useValue: {} },
        { provide: getModelToken(MaterialPurchase.name), useValue: {} },
      ],
    }).compile();

    service = module.get<TutorMaterialsService>(TutorMaterialsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
