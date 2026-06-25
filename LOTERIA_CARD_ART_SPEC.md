# La Lotería — Card Art Specification

A brief for creating the 54 Lotería card images for **The Broken Flagon**.
The deck follows the classic Don Clemente / Gallo *tradition* (the famous one).

---

## How the art drops into the game

- Each card image is a **full rectangular card**: artwork, decorative border, and
  the card's name, all baked into one image. The game draws it edge-to-edge in
  the cell — it does **not** add its own frame or label.
- Save each file as **`sprites/loteria/<number>.png`**, where `<number>` is the
  card's number below (1–54). Example: El Gallo → `sprites/loteria/1.png`.
- The game already looks for these files. Until a file exists, that card shows
  the unicode-glyph placeholder. Drop art in **one card at a time** and it
  upgrades automatically — no code changes, no need for all 54 at once.

## Recommended dimensions

- **Aspect ratio:** roughly **3 : 4** (taller than wide), the classic Lotería
  card shape.
- **Size:** **300 × 400 px** is a good target (crisp on the 4×4 board at any of
  the 1–4 tabla sizes). 600 × 800 px if you want extra sharpness; the game
  scales down cleanly.
- **Format:** PNG. A transparent margin is fine but not required, since the
  card border is part of the art.
- **Keep the name readable** at small sizes — on a 4-tabla board each card is
  only ~52 px wide, so bold, simple lettering reads best.

---

## ⚠️ One decision to make first: the verses (coplas)

The card **names and subjects** below (El Gallo the rooster, La Sirena the
mermaid, etc.) are the shared tradition — free to use, and what makes the deck
authentic.

The **printed verses** ("coplas") from the Don Clemente / Gallo deck are a
different matter: that specific verse text is **copyrighted** by the publisher.
The game currently has those original verses in its data. For a free hobby
build that's a grey area; for a **product sold on Steam** it's worth changing.

Three honest options — your call:
1. **Use your family's own calls.** Many families have their own way of calling
   each card. These would be more personal and *more* authentic than the
   mass-printed text — and unquestionably yours to ship.
2. **Write original verses** in the same playful, rhyming spirit.
3. **Drop verses entirely** and let the caller just announce the card name.

The art itself should likewise be an **original rendering** of each subject, not
a trace or copy of the Gallo illustrations — same subjects, your hand.

---

## The 54 cards

For each: **number** (= filename), **traditional name**, **English meaning**,
and **what the card classically depicts** as a drawing brief. Verses are
deliberately omitted here per the note above.

| # (file) | Name | Meaning | Classic subject to depict |
|---|---|---|---|
| 1  | El Gallo       | The Rooster      | A rooster, crowing, often in profile |
| 2  | El Diablito    | The Little Devil | A small red devil with horns and tail |
| 3  | La Dama        | The Lady         | An elegant woman walking, often with a handbag |
| 4  | El Catrín      | The Dandy        | A well-dressed gentleman: top hat, cane, suit |
| 5  | El Paraguas    | The Umbrella     | An open umbrella |
| 6  | La Sirena      | The Mermaid      | A mermaid rising from the water |
| 7  | La Escalera    | The Ladder       | A wooden ladder |
| 8  | La Botella     | The Bottle       | A single bottle |
| 9  | El Barril      | The Barrel       | A wooden barrel |
| 10 | El Árbol       | The Tree         | A full leafy tree |
| 11 | El Melón       | The Melon        | A melon, often a cut wedge showing seeds |
| 12 | El Valiente    | The Brave Man    | A man holding a knife/machete, defiant stance |
| 13 | El Gorrito     | The Little Bonnet| A baby's bonnet/cap |
| 14 | La Muerte      | Death            | A skeleton (la muerte) with a scythe |
| 15 | La Pera        | The Pear         | A single pear |
| 16 | La Bandera     | The Flag         | The Mexican flag (green, white, red) |
| 17 | El Bandolón    | The Mandolin     | A bandolón / mandolin instrument |
| 18 | El Violoncello | The Cello        | A cello |
| 19 | La Garza       | The Heron        | A heron standing by water |
| 20 | El Pájaro      | The Bird         | A small perched bird |
| 21 | La Mano        | The Hand         | An open hand, palm forward |
| 22 | La Bota        | The Boot         | A single tall boot |
| 23 | La Luna        | The Moon         | A crescent moon, often with a face |
| 24 | El Cotorro     | The Parrot       | A parrot on a perch |
| 25 | El Borracho    | The Drunkard     | A staggering man with a bottle |
| 26 | El Negrito     | (traditional figure) | A figure in formal dress — see note below |
| 27 | El Corazón     | The Heart        | A single red heart (often with an arrow) |
| 28 | La Sandía      | The Watermelon   | A watermelon slice, red with seeds |
| 29 | El Tambor      | The Drum         | A drum with sticks |
| 30 | El Camarón     | The Shrimp       | A shrimp |
| 31 | Las Jaras      | The Arrows       | A bundle of arrows |
| 32 | El Músico      | The Musician     | A musician playing (often a trumpet) |
| 33 | La Araña       | The Spider       | A spider |
| 34 | El Soldado     | The Soldier      | A soldier standing guard |
| 35 | La Estrella    | The Star         | A single five-pointed star |
| 36 | El Cazo        | The Saucepan     | A cooking pot / saucepan with handle |
| 37 | El Mundo       | The World        | A globe of the world |
| 38 | El Apache      | (traditional figure) | A figure with a bow — see note below |
| 39 | El Nopal       | The Cactus       | A nopal (prickly-pear cactus), often with tunas |
| 40 | El Alacrán     | The Scorpion     | A scorpion |
| 41 | La Rosa        | The Rose         | A single red rose |
| 42 | La Calavera    | The Skull        | A skull (calavera) |
| 43 | La Campana     | The Bell         | A hanging bell |
| 44 | El Cantarito   | The Water Jug    | A small clay water jug (cántaro) |
| 45 | El Venado      | The Deer         | A leaping deer |
| 46 | El Sol         | The Sun          | A radiant sun, often with a face |
| 47 | La Corona      | The Crown        | A royal crown |
| 48 | La Chalupa     | The Canoe        | A woman rowing a chalupa (flat boat) |
| 49 | El Pino        | The Pine Tree    | A pine tree |
| 50 | El Pescado     | The Fish         | A single fish |
| 51 | La Palma       | The Palm Tree    | A palm tree |
| 52 | La Maceta      | The Flowerpot    | A flowerpot with a plant |
| 53 | El Arpa        | The Harp         | A harp |
| 54 | La Rana        | The Frog         | A green frog |

### A note on cards 26 and 38

**El Negrito** and **El Apache** are part of the historical deck, but their
traditional depictions carry racial caricature that hasn't aged well. Since
you're making **original** art, this is a chance to render these cards
respectfully — keeping the name and the card's place in the deck while drawing
the figure with dignity rather than copying the old caricature. Worth a
conversation with your wife on how she'd like them handled; some modern decks
reinterpret these two thoughtfully.

---

## Suggested workflow

1. Start with a few visually distinctive cards (El Sol, La Luna, La Sirena,
   El Corazón) to lock your art style.
2. Drop each `sprites/loteria/<n>.png` in and check it in-game on a 1-tabla and
   a 4-tabla board — make sure the name stays legible when small.
3. Have your wife review names, subjects, and (if you keep them) the verses.
   She's the authenticity check.
4. Fill in the rest at whatever pace suits you; the game works the whole time.
