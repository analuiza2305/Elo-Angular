import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PosConsulta } from './pos-consulta';

describe('PosConsulta', () => {
  let component: PosConsulta;
  let fixture: ComponentFixture<PosConsulta>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PosConsulta],
    }).compileComponents();

    fixture = TestBed.createComponent(PosConsulta);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
