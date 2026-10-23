import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Artigos } from './artigos';

describe('Artigos', () => {
  let component: Artigos;
  let fixture: ComponentFixture<Artigos>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Artigos],
    }).compileComponents();

    fixture = TestBed.createComponent(Artigos);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
