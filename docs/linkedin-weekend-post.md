# LinkedIn, weekend-project cut, 2026-08-02

Short version, roughly 1,700 characters. The longer technical cut is in
linkedin-post.md if a deeper post is wanted later.

Links: put russh.work/blog/inside-cookspec and
russh.work/blog/field-cookspec-eval in the first comment, since LinkedIn
suppresses outbound links in the post body.

---

Weekend project: I rebuilt a recipe format from 2004 that nobody adopted.

Michael Chu has been publishing recipes at Cooking for Engineers since 2004 in a tabular notation. Ingredients run down the left edge, operations merge column by column into the finished dish. It is a dependency graph rendered as a table, and it answers the two things a recipe page usually buries: what goes with what, and in what order.

It never spread, because producing it by hand is real work. That work is cheap now. Reading an unstructured source and emitting a dependency graph is something models are actually good at.

So I built CookSpec. Paste a TikTok, a Reel, a YouTube link, an article, or a photo of a cookbook page, and it compiles into one table with every quantity normalized and checked against a density table. It caught a cocoa measurement in the recipe that inspired it, off by a factor of three.

Then someone used it and told me the output was wrong. Their mango sticky rice card assumed the rice was already cooked, and it should have started from boiling the rice. Verifying that properly turned into 2,000 compiles across five channels. Three things fell out.

The eval found two bugs in my own metrics before it found any in the product. I nearly reported a 12.6 percent ingredient loss that did not exist.

Prompt instructions are probabilistic. The model followed my new rule most of the time and evaded it twice: once by moving the word "cooked" out of the ingredient name and into the quantity text, once by hiding the cooking step in a prep note. The fix was moving the rule out of the prompt and into code that can fail.

The worst defect never threw an error. Roundup pages were producing invented recipes presented as extracted, sitting invisible inside a 95 percent success rate.

After: cards the judge called not cookable went 12.8 to 5.0 percent, genuine failures were cut in half, and 157 sources are now refused with a stated reason instead of fabricated. One of them was a travel photo whose hashtag had autocorrected from Recife to recipe.

Live at cookspec.xyz. Build notes and the full evaluation are in the comments.
