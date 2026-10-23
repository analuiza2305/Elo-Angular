import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HomeMae } from './home-mae';

describe('HomeMae', () => {
  let component: HomeMae;
  let fixture: ComponentFixture<HomeMae>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeMae],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeMae);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
