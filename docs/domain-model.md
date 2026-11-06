# Modèle de domaine

Une `Sequence` est l’unité annuelle unique. `SequenceLevel` associe un ou plusieurs niveaux à cette séquence sans copier ses séances. Une `Lesson` existe une seule fois ; `LessonLevel` décrit ses cibles, et `LessonProgress` conserve un avancement distinct pour chaque niveau.

Un `WeeklyPlan` identifie une semaine par sa date de lundi et sa classe. `LessonSchedule` historise chaque affectation. Un index unique partiel PostgreSQL n’autorise qu’une affectation `ACTIVE` d’une séance à la fois. Une affectation retirée ou inachevée est clôturée en `POSTPONED`, puis une nouvelle affectation peut référencer le même `lessonId`. Les séances terminées sont `COMPLETED`, annulées `CANCELLED`.

Les transitions de bilan, écritures de progression et événements sont enregistrés dans une transaction. Les événements ne remplacent pas les états projetés de progression ou d’affectation.

## Progression

La charge prévue d’une séquence est la somme des durées de ses séances distinctes. Pour la synthèse globale d’une séance commune à plusieurs niveaux, chaque contribution de niveau est divisée par le nombre de niveaux cibles afin de ne compter la durée qu’une fois. Dans une vue par niveau, la contribution est la durée entière : 100 % si `DONE`, 0 % si `NOT_STARTED`, et la durée réalisée bornée à la durée prévue si `PARTIAL`. Les séances annulées ne contribuent pas au réalisé et sont dénombrées séparément. Une absence de charge exploitable retourne une progression indéterminée (`null`), jamais un pourcentage artificiel.

## Calendrier

Le calcul local connaît les jours fériés nationaux fixes et les fêtes mobiles françaises calculées à partir de Pâques. Les exceptions de classe priment les jours habituels et les jours fériés. L’adaptateur vers un fournisseur officiel et le mapping académie/zone ne sont pas encore implémentés ; les vacances scolaires ne sont donc pas déduites. `SchoolCalendarCache` prépare leur stockage futur. L’API annonce explicitement cette limite.