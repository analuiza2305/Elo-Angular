import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { HomeMaeComponent } from './home-mae';

describe('HomeMaeComponent', () => {
  let component: HomeMaeComponent;
  let fixture: ComponentFixture<HomeMaeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeMaeComponent],
      providers: [provideRouter([{ path: '**', children: [] }])],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeMaeComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
