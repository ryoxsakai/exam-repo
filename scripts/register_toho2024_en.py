#!/usr/bin/env python3
"""東邦大学医学部 2024 英語大問を Worker API へ登録する。"""
import json
import urllib.request

API = "https://medical-exam-worker.ryoxsakai.workers.dev/api/exams"
EXTRACT = json.load(open("/tmp/toho2024_extract.json"))

UNI = "東邦大学"
YEAR = 2024
SCHEDULE = "一般"


def slice_between(text, start, end=None):
    i = text.find(start)
    if i < 0:
        return ""
    i += len(start)
    if end:
        j = text.find(end, i)
        if j >= 0:
            return text[i:j].strip()
    return text[i:].strip()


def post_exam(questions):
    body = {
        "universityName": UNI,
        "year": YEAR,
        "schedule": SCHEDULE,
        "questions": questions,
    }
    req = urllib.request.Request(
        API,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": "exam-db-register/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.loads(res.read().decode())


def build_problem(*sections):
    """sections: list of (type, text). 問題以外は {{type}} 見出しを付与。"""
    lines = []
    for typ, text in sections:
        if typ != "問題":
            lines.append("{{" + typ + "}}")
        if text and text.strip():
            lines.append(text.strip())
    return "\n\n".join(lines)


# ── 大問1: 睡眠紡錘と虚偽記憶 ─────────────────────────────
DAI1_PASSAGE = """Our memory is imperfect: We remember some moments but lose others like a problematic tape recorder. Sometimes, we even "remember" things that never happened — a phenomenon that researchers call "false memory" (and a reason why eyewitness testimonies can be misleading).

But where do these false memories come from? Previous studies have suggested that sleep plays a role in the formation of false memories, and in a recent small study, researchers homed in on one particular aspect of sleep, called sleep spindles, as the potential culprit.

Sleep spindles are quick bursts of brain activity during sleep, according to the study, which was published in the journal Neuropsychologia. They occur in one of the lighter stages of sleep, called Stage 2, which is defined by a slowed heart rate and no eye movement.

To study how sleep spindles may play a role in the formation of false memories, the researchers recruited 32 well-rested, non-caffeinated university students. The participants were shown a handful of words — all related to the same topic — before being hooked up to a polysomnography device, which monitors brain activity during sleep. The participants were then randomly assigned to one of two groups: a napping group or an awake group. The napping group was sent to a room with a bed and blackout blinds, while the awake group was told to watch a nature documentary or a Mr. Bean cartoon. The polysomnography device recorded brain activity to make sure the napping group was actually asleep and not just lying in bed. [B]

After their respective activities, all of the participants were again shown a series of words and were asked if they had seen the words before. What's more, the researchers threw in some "lure" words that were related to the topic of all the words but weren't shown to the participants before.

The researchers found that the students who napped were significantly more likely to fall victim to "lure" words and say that they had seen the words before, creating false memories. The findings were what the researchers had predicted based on previous studies.

But the researchers also wanted to test if one side of the brain was more gullible than the other. To do so, the researchers designed the experiment so that the words flashed on the screen far to the left or far to the right in a visual field available to only one brain hemisphere at a time. If you blinked, you missed the word, said lead study author John Shaw, a psychology doctoral student at Lancaster University in England. But this wasn't to be annoying, he added; if the words stayed on the screen for longer, then participants' eyes would adjust so that both hemispheres could read the word.

The study found that the right hemisphere of the nappers' brains — which had a greater number of spindles during sleep, as recorded by the polysomnography device — fell more susceptible to "lure" words or false memories than the left. For example, the spindles might promote the word "sleep" by promoting the __general gist__ of words it had previously seen, such as "bed," "dream," "nap" or "snooze," Shaw said.

Sleep spindles have been linked to memory formation before, but previous studies of sleep spindles have only examined true memories, not false memories, Shaw told Live Science. Indeed, sleep spindles are thought to play a very important role in consolidating short-term memory into long-term archives in the brain, and can also aid in cortical development. But this is the first study to find that sleep "spindles are accidentally creating false memories," Shaw said.

But don't get too mad at your brain — it's just trying to be efficient. "I think that the sleeping brain spends a lot of time and effort trying to identify the most important aspects of what was learned during the previous day," said Robert Stickgold, director of the Center for Sleep and Cognition at Beth Israel Deaconess Medical Center, who was not part of the study.

Stickgold noted that the new study doesn't provide enough evidence to undoubtedly say that the right side of the brain is dominant in creating false memories during sleep. "It didn't __hit__ statistical significance, but it was close," he told Live Science. "But the correlation with sleep spindles is stronger, and I suspect it is real."

Because the study was small, Shaw said he hopes to increase the number of participants with subsequent experiments, in addition to expanding from naps to following the brain's mischief across a full night's sleep.

!!!!出典: Naps Can Make Our Brains 'Remember' Things That Never Happened, Live Science on May 3, 2018 by John Shaw!!!!"""

DAI1_Q = """次の英文を読み、設問 1. 〜 15. に最も適した答えを ((a)) 〜 ((d)) の中から一つ選べ。

----

""" + DAI1_PASSAGE + """

----

{{問1}} According to paragraphs 1 and 2, which of the following is true?
((a)) Lack of sleep results in the formation of false memories.
((b)) False memory is the phenomenon of misremembering an event.
((c)) Researchers view people's memory as a problematic tape recorder.
((d)) False memory is often the result of misleading eyewitness testimonies.

{{問2}} The underlined phrase "homed in" in paragraph 2 is closest in meaning to
((a)) carried
((b)) focused
((c)) insisted
((d)) relied

{{問3}} According to paragraph 3, which of the following is NOT true?
((a)) Eyes do not move during sleep spindles.
((b)) Sleep spindles occur while the heart rate is slowed.
((c)) The possible cause of sleep spindles is false memory.
((d)) Sleep spindles occur in a lighter stage of the sleep cycle.

{{問4}} Which of the following is true about the experiment described in paragraph 4?
((a)) The napping group was blindfolded before being sent to a room.
((b)) Students in the awake group watched a cartoon in a room with blackout blinds.
((c)) The napping group was told to simply lie down in the bed and not to fall asleep.
((d)) University students were shown a list of words before they put on a medical device.

{{問5}} Where would the following sentence best fit in paragraphs 4 and 5? Choose [A], [B], [C] or [D].
Some of the words were repeats from the first session, but some were new.

{{問6}} According to paragraphs 5 and 6, which of the following is true?
((a)) False memories were likely to occur in students who were awake.
((b)) The results were consistent with what the researchers had anticipated.
((c)) The students who napped were able to tell which of the words were the lure words.
((d)) Participants had previously been shown the lure words that the researchers threw in.

{{問7}} The underlined word "gullible" in paragraph 7 is closest in meaning to
((a)) discerning
((b)) hardwired
((c)) sensible
((d)) unsuspecting

{{問8}} The experiment was designed in such a way that
((a)) both sides of the brain were tested at the same time
((b)) participants would not miss a word even if they blinked
((c)) only one hemisphere of the brain was working at a time
((d)) the words were flashed on the far side of the visual field on either side

{{問9}} According to paragraph 8, which of the following is true?
((a)) Nappers' brains had more spindles during sleep.
((b)) The word "sleep" was recognized more quickly than "nap" or "snooze."
((c)) The brain was likely to remember the word "sleep" if it had seen words such as "dream."
((d)) Nappers' left hemispheres were more prone to false memories than their right hemispheres.

{{問10}} The underlined words "general gist" in paragraph 8 is closest in meaning to
((a)) appropriate content
((b)) basic meaning
((c)) common usage
((d)) subtle nuances

{{問11}} According to paragraphs 9 and 10, which of the following is true?
((a)) People often resent their brain for being too inefficient.
((b)) The brain spends a lot of time and effort trying to stay asleep.
((c)) False memory has been linked to the formation of sleep spindles.
((d)) The sleeping brain searches for key ideas from the previous day's learning.

{{問12}} According to paragraphs 9 - 11, which of the following is NOT true?
((a)) Sleep spindles may assist in the development of the cortex.
((b)) Previous studies of sleep spindles have examined only true memories.
((c)) Sleeping spindles have not been previously associated with memory formation.
((d)) Sleep spindles help the brain convert short-term memory into long-term memory.

{{問13}} The underlined word "hit" in paragraph 11 is closest in meaning to
((a)) bear
((b)) gain
((c)) reach
((d)) share

{{問14}} Robert Stickgold thinks that
((a)) sleep spindles and false memories are strongly correlated
((b)) the study supports the claim that the right side of the brain is dominant
((c)) creative memories are produced in the right side of the brain during sleep
((d)) the creation of false memories during sleep involves both sides of the brain

{{問15}} According to the passage, which of the following is true?
((a)) Researchers recruited students who drank a lot of coffee for the experiment.
((b)) Researchers hope to track sleep spindles over the course of a full night's sleep.
((c)) The study showed that sleep spindles don't accidentally produce misleading memories.
((d)) The subjects' eyes adjusted to the words on the screen so that only one hemifield could read the words."""

# ── 大問2: Cat Sense ─────────────────────────────────────
DAI2_PASSAGE = """Cats are not born attached to people; they're born ready to learn how to attach themselves to people. Any kitten denied experience with people will revert toward its ancestral wild state and become feral. Something in their evolution has given domestic cats the inclination — and it's no more than that — to trust people during a brief period when they're tiny kittens. This minute advantage enabled a few wildcats to leave their origins behind and find their place in environments created by the planet's dominant species. Only one other animal has done this more successfully than the domestic cat, and that, [[1]], is the domestic dog. Like puppies, kittens arrive into the world helpless, and then have just a few weeks in which to learn about the animals around them — an even shorter time for cats than for dogs — before they must make their own way in the world. By comparison with our own infants, which are dependent on us for years, this is a very [[2]] period.

Even in their wild ancestors, the wolf and the wildcat, this window must have been open just a crack, waiting for evolution to allow the young animals of these two species to learn to trust us, and thereby become domesticated.

Kittens and puppies alike become more closely integrated into human society than any other animal can, but the way the two species achieve this [[3]]. Early scientific studies of dogs from the 1950s established the notion of a primary socialization period, a few weeks in the puppy's life when it is especially sensitive to learning how to interact with people. A puppy handled every day from seven to fourteen weeks of age will be friendly toward people and virtually indistinguishable from a puppy whose handling started four weeks earlier. For the next quarter century, scientists generally assumed that kittens must be the same, [[4]] it was not essential to handle kittens until they were seven weeks old. In the 1980s, when researchers finally performed corresponding tests on cats, those recommendations had to change.

These experiments confirmed that the concept of a socialization period could indeed be applied to cats, but that this period was comparatively curtailed in kittens. The researchers handled some kittens from three weeks old, some from seven weeks old, and the rest not until the testing started at fourteen weeks. The kittens started learning about people much earlier than puppies do. As expected, the kittens handled from their third week were happy to sit on a lap when they reached fourteen weeks old, but those whose contact with people had been delayed to seven weeks jumped off within half a minute — though not as quickly as those that had never been handled during their first fourteen weeks, which stayed put for less than fifteen seconds.

Could this be explained by the seven-week-handled kittens being more active than the three-week — in other words, no less happy to be on a person's lap, just more eager to explore their surroundings? It quickly became obvious that this could not be the [[5]]. When each kitten was subsequently given the opportunity to cross a room toward one of their handlers, only the three-week kittens did so reliably — and were quick to do it, too, giving every impression that they were attracted to the person who was by then very familiar to them. The seven-week and unhandled kittens did not seem unduly frightened of the person, and would occasionally get close to her. Some even apparently asked to be [[6]], but these two groups were more or less indistinguishable in their behavior.

The handling that those seven-week kittens received up to the point of testing had not produced the powerful [[7]] to people that was obvious from the behavior of the three-week kittens. For the scientists taking part, the tests simply formalized what was already obvious from the kittens' behavior. As the leader of the research team noted, "In observing and interacting with these cats during testing and in their home rooms, it was obvious to everyone working in the lab that the late-handled [i.e., seven-week] cats behaved more like the unhandled cats."

The scientists concluded that cats need to start learning about people much earlier than dogs must. Dog breeders ought to handle puppies before they are eight weeks old, but if puppies are not handled until that age, then with the right [[9]] treatment they can still become perfectly happy pets. A kitten that encounters its first human in its ninth week is likely to be anxious when near people for the rest of its life. The paths that lead to an affectionate pet on one hand and a wild scavenger on the other — [[10]] early in the cat's life; indeed, if it were any earlier, few cats would be able to forge relationships with us.

!!!!出典: Cat Sense by John Bradshaw, Basic Books!!!!"""

DAI2_Q = """次の英文を読み、1〜10 の空所に入る最も適した語を a.〜d. から一つ選べ。

----

""" + DAI2_PASSAGE + """

----

{{問1}} [[1]]
((a)) for instance
((b)) agit
((c)) in the end
((d)) of course

{{問2}} [[2]]
((a)) brief
((b)) long
((c)) regular
((d)) scarce

{{問3}} [[3]]
((a)) affords
((b)) differs
((c)) exists
((d)) possesses

{{問4}} [[4]]
((a)) and that
((b)) as if
((c)) even though
((d)) simply because

{{問5}} [[5]]
((a)) eventually
((b)) minutely
((c)) oddly
((d)) typically

{{問6}} [[6]]
((a)) outcome
((b)) cause
((c)) experiment
((d)) opposite

{{問7}} [[7]]
((a)) turned down
((b)) thrown away
((c)) picked up
((d)) put off

{{問8}} [[8]]
((a)) attraction
((b)) contraction
((c)) protraction
((d)) subtraction

{{問9}} [[9]]
((a)) biological
((b)) remedial
((c)) surgical
((d)) chemical

{{問10}} [[10]]
((a)) compete
((b)) incorporate
((c)) diverge
((d)) withdraw"""

QUESTIONS = [
    {
        "questionNumber": 1,
        "category": "長文",
        "problemText": build_problem(
            ("問題", DAI1_Q),
            (
                "全訳",
                slice_between(EXTRACT["answer_p11"], "《坂眠が生成する雇作記憶》", "《"),
            ),
        ),
        "answerText": "1. ((a))  2. ((d))  3. ((b))  4. ((b))  5. ((b))\n6. ((a))  7. ((c))  8. ((c))  9. ((b))  10. ((a))\n11. ((c))  12. ((c))  13. ((c))  14. ((a))  15. ((d))",
        "commentaryText": slice_between(
            EXTRACT["answer_p12"], "解説", "《交と大の入へのなつき方の培い》"
        ),
    },
    {
        "questionNumber": 2,
        "category": "長文",
        "problemText": build_problem(
            ("問題", DAI2_Q),
            (
                "全訳",
                slice_between(EXTRACT["answer_p14"], "《交と大の入へのなつき方の培い》", "解説"),
            ),
        ),
        "answerText": "1. ((d))  2. ((a))  3. ((b))  4. ((b))  5. ((d))\n6. ((a))  7. ((c))  8. ((a))  9. ((b))  10. ((c))",
        "commentaryText": slice_between(EXTRACT["answer_p15"], "解説", "noRARHR"),
    },
]

if __name__ == "__main__":
    print("Registering", len(QUESTIONS), "questions...")
    res = post_exam(QUESTIONS)
    print(json.dumps(res, ensure_ascii=False, indent=2)[:2000])
