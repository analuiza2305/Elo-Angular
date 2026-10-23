import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ArtigosFavoritos } from './artigos-favoritos';

describe('ArtigosFavoritos', () => {
  let component: ArtigosFavoritos;
  let fixture: ComponentFixture<ArtigosFavoritos>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArtigosFavoritos],
    }).compileComponents();

    fixture = TestBed.createComponent(ArtigosFavoritos);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
