import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HomeAdv } from './home-adv';

describe('HomeAdv', () => {
  let component: HomeAdv;
  let fixture: ComponentFixture<HomeAdv>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeAdv],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeAdv);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
