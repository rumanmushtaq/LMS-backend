import { Test, TestingModule } from '@nestjs/testing';
import { TutorMaterialsController } from './tutor-materials.controller';

describe('TutorMaterialsController', () => {
  let controller: TutorMaterialsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TutorMaterialsController],
    }).compile();

    controller = module.get<TutorMaterialsController>(TutorMaterialsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
