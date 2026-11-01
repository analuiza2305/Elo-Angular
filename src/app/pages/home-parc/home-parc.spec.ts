import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { HomeParc } from './home-parc';

describe('HomeParc', () => {
  let component: HomeParc;
  let fixture: ComponentFixture<HomeParc>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeParc],
      providers: [provideRouter([{ path: '**', children: [] }])],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeParc);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
