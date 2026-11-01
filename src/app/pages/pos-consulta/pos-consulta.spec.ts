import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PosConsultaComponent } from './pos-consulta';

describe('PosConsultaComponent', () => {
  let component: PosConsultaComponent;
  let fixture: ComponentFixture<PosConsultaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PosConsultaComponent],
      providers: [provideRouter([{ path: '**', children: [] }])],
    }).compileComponents();

    fixture = TestBed.createComponent(PosConsultaComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
