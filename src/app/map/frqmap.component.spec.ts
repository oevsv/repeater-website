import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AppModule } from '../app.module';
import { FrqmapComponent } from './frqmap.component';

// The map (OpenLayers) watches its size; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

// AppModule declares the component with its pipes.
describe('FrqmapComponent', () => {
  let component: FrqmapComponent;
  let fixture: ComponentFixture<FrqmapComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppModule],
      providers: [
        provideZonelessChangeDetection(), // the tests run without zone.js
        provideHttpClient(),
        provideHttpClientTesting(), // no backend: requests to /api stay pending
      ],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(FrqmapComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
