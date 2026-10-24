import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Videochamada } from './videochamada';

describe('Videochamada', () => {
  let component: Videochamada;
  let fixture: ComponentFixture<Videochamada>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Videochamada],
    }).compileComponents();

    fixture = TestBed.createComponent(Videochamada);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
