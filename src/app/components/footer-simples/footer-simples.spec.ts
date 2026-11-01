import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FooterSimplesComponent } from './footer-simples';

describe('FooterSimplesComponent', () => {
  let component: FooterSimplesComponent;
  let fixture: ComponentFixture<FooterSimplesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FooterSimplesComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FooterSimplesComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
