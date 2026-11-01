import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Forum } from './forum';

describe('Forum', () => {
  let component: Forum;
  let fixture: ComponentFixture<Forum>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Forum],
      providers: [provideRouter([{ path: '**', children: [] }])],
    }).compileComponents();

    fixture = TestBed.createComponent(Forum);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
