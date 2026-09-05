import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgendaMae } from './agenda-mae';

describe('AgendaMae', () => {
  let component: AgendaMae;
  let fixture: ComponentFixture<AgendaMae>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgendaMae],
    }).compileComponents();

    fixture = TestBed.createComponent(AgendaMae);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
