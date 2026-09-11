import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComentResp } from './coment-resp';

describe('ComentResp', () => {
  let component: ComentResp;
  let fixture: ComponentFixture<ComentResp>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComentResp],
    }).compileComponents();

    fixture = TestBed.createComponent(ComentResp);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
