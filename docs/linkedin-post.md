# LinkedIn draft, 2026-08-02

Paste as-is. No em-dashes, no exclamation points, no hype vocabulary. Roughly
3,300 characters, which reads as a long-form technical post rather than a
status update.

---

A user told me one of my outputs was wrong. Verifying that properly took 2,000 compiles, and it surfaced two bugs in my own evaluation before it surfaced any in the product.

Context: I build a system that compiles a recipe from any source, TikTok, Reel, YouTube, article, or photo, into one merge table with the units normalized and checked against a density table. Someone compiled mango sticky rice and got a card that assumed the rice was already cooked. Their phrasing was exact: it should start from boiling the rice.

The card had three operations. None of them cooked rice. The full article version of the same dish compiled correctly, so this was specific to terse sources.

The generalization is the part worth keeping. An extraction system reproduces its source's frame, including the source's omissions. The creator wrote from a stocked kitchen, and the model preserved that assumption faithfully. Faithfulness to the source and usefulness to the user are different objectives, and nothing in my pipeline was expressing the second one.

Four things I took from the work.

1. Build the measurement before the fix, especially when the fix looks obvious.

I assembled 1,003 items across five channels: real content sampled from sitemaps with robots.txt honored per domain, video from channel feeds and bounded scraper sampling, plus a stress set derived from public-domain recipes and degraded the way a caption degrades a recipe, with the original structured data retained as ground truth. Deterministic checks run on every item. A rubric judge scores a sample, and it runs on a model family that is not in the extraction path, because grading a model with its own family is not a measurement you can defend.

2. Verify the instrument before you trust what it prints.

My first report claimed the pipeline was dropping 12.6 percent of source ingredients. Before writing that down I recompiled the worst offender and read the card. It was complete. My matcher was diluting real matches against parenthetical asides like "1 cup sugar (I used organic cane sugar)". Actual coverage is 99.3 percent. An eval that is wrong against you is worse than one wrong in your favor, because you will change working code to satisfy it.

3. Prompt instructions are probabilistic. Gates are deterministic.

I put the rule in the prompt. The model complied most of the time and evaded twice, both times inventively: once by moving the word "cooked" out of the ingredient name and into the quantity text, once by moving the cooking stage into a prep note, off the table entirely. So the rule became a validation function that fails the card and returns it to the repair loop. My first version of that gate had a hole of its own, matching "warm" inside "pour warm coconut mixture", and it passed the exact card it existed to reject.

When a constraint matters, express it as code that can fail, not as a sentence the model is asked to honor.

4. The failure that costs you users is the one that does not throw.

The worst finding was not in any error column. Roundup pages and technique explainers were producing invented recipes presented as extracted. Confident, well formatted, fabricated. The system now declines them with a stated reason. That was 157 sources in this corpus, including a privacy policy, an educational animation about dishwashers, and a travel photo whose hashtag had autocorrected from Recife to recipe.

Results, 999 items per run:

Genuine compile failures, 4.4 percent to 2.3 percent
Cards the judge called not cookable, 12.8 percent to 5.0 percent
Placeholder cards from non-recipe pages, 6.7 percent to 1.1 percent
Judge completeness, 3.73 to 4.09 out of 5

One number moved the wrong way on its face. Raw compile rate fell from 95.6 percent to 82 percent. That entire gap is the refusals, and the corpus was sampled indiscriminately, so it holds far more non-recipes than real usage will. Reporting refusals as failures would have hidden the improvement, so the report counts them separately. A system that learned to say no should not look like a system that broke.

Both runs cost about nine dollars.

Field notes with the harness design, the metric bugs, and the full results are linked below.

---

## Notes on posting

- Attach or link the field notes page. LinkedIn suppresses outbound links in
  the post body, so put the link in the first comment if reach matters.
- If a shorter cut is wanted, sections 2 and 3 stand alone. Section 3 is the
  strongest single idea for an engineering audience.
- Suggested first comment: the repository link, plus one line saying the
  corpus, grader, judge, and both run records are included.
