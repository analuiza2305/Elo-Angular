import { TestBed } from '@angular/core/testing';

import { Lembrete } from './lembrete';

describe('Lembrete', () => {
  let service: Lembrete;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Lembrete);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
