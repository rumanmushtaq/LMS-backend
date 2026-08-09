import { Test, TestingModule } from '@nestjs/testing';
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
      ],
    }).compile();

    controller = module.get<TutorMaterialsController>(TutorMaterialsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
