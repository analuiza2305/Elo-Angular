import { Component } from '@angular/core';

@Component({
  selector: 'app-footer-simples',
  standalone: true,
  templateUrl: './footer-simples.html',
  styleUrls: ['./footer-simples.css']
})
export class FooterSimplesComponent {
  ano = new Date().getFullYear();
}
