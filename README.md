# Kalkulator Limova

Web aplikacija za optimizaciju rezanja limova (coil sirina) sa ciljem smanjenja otpada.

## Sta radi

- Unos narudzbe po stavkama: `sirina`, `duzina`, `kolicina`
- Odabir dostupnih coil sirina
- Planiranje tabli duzine do `8m`
- Minimizacija otpada uz:
  - DP (dinamicko programiranje) po sirini table
  - kesiranje DP rezultata
  - beam search izbor sljedece table
  - iskoristenje ostataka traka po duzini
  - post-optimizaciju za smanjenje broja tabli
- Vizuelni prikaz svake table i rezova

## Struktura projekta

- `index.html` - UI struktura
- `style.css` - stil i responsive izgled
- `app.js` - logika optimizacije i prikaz rezultata

## Pokretanje

Otvorite `index.html` u browseru.

Nema dodatnih dependencija ni build koraka.

## Koristenje

1. Unesite stavke narudzbe.
2. Oznacite dostupne coilove.
3. Kliknite `Izracunaj plan rezanja`.
4. Pregledajte rezultat po tablama i ukupni otpad.

## Napomena

Proracun je heuristicki optimizovan za prakticna rjesenja (brzina + kvalitet), ne garantuje apsolutni globalni optimum za sve ulaze.

## Roadmap

- eksport rezultata (PDF/Excel)
- dodatni debug/benchmark prikaz
- opcioni "exact mode" za manje narudzbe
