import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HomeParc } from './home-parc';

describe('HomeParc', () => {
  let component: HomeParc;
  let fixture: ComponentFixture<HomeParc>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeParc],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeParc);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
