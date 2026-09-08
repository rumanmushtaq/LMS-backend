import { Test, TestingModule } from '@nestjs/testing';
import { MaterialsCheckoutService } from './materials-checkout.service';
import { TutorMaterialsController } from './tutor-materials.controller';
import { TutorMaterialsService } from './tutor-materials.service';
import { UploadService } from '../admin/services/upload.service';

describe('TutorMaterialsController', () => {
  let controller: TutorMaterialsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TutorMaterialsController],
      providers: [
        { provide: TutorMaterialsService, useValue: {} },
        { provide: UploadService, useValue: {} },
        { provide: MaterialsCheckoutService, useValue: {} },
      ],
    }).compile();

    controller = module.get<TutorMaterialsController>(TutorMaterialsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
