import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConsultaListaPsiComponent } from './consulta-lista-psi';

describe('ConsultaListaPsiComponent', () => {
  let component: ConsultaListaPsiComponent;
  let fixture: ComponentFixture<ConsultaListaPsiComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConsultaListaPsiComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ConsultaListaPsiComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});