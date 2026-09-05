import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ArtigoInd } from './artigo-ind';

describe('ArtigoInd', () => {
  let component: ArtigoInd;
  let fixture: ComponentFixture<ArtigoInd>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArtigoInd],
    }).compileComponents();

    fixture = TestBed.createComponent(ArtigoInd);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
