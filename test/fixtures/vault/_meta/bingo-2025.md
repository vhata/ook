---
year: 2025
title: 2025 Test Bingo
size: 3
free_square: center
squares:
  - id: a1
    title: Some 2025 Book
    authors: [Some Author]
    book: null
    done: false
  - id: a2
    title: Private Book
    authors: [Solo Author]
    book: PrivateBook
    # Stored value is a lie — PrivateBook is reading, not finished. Used in
    # tests to prove the derived value wins over the YAML field.
    done: true
  - id: a3
    title: Another 2025
    authors: [Other Author]
    book: null
    done: false
  - id: b1
    title: Filler
    authors: [Filler Author]
    book: null
    done: false
  - id: b2
    free: true
  - id: b3
    title: Filler
    authors: [Filler Author]
    book: null
    done: false
  - id: c1
    title: Filler
    authors: [Filler Author]
    book: null
    done: false
  - id: c2
    title: Filler
    authors: [Filler Author]
    book: null
    done: false
  - id: c3
    title: Filler
    authors: [Filler Author]
    book: null
    done: false
---
