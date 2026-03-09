/**
 * CerberusAgent — Benchmark Corpus
 *
 * Curated test cases for comparing panoptic vs monolithic.
 * Each case is designed to test specific aspects of the
 * multi-head architecture.
 */

import { BenchmarkCase } from './types.js';

export const BENCHMARK_CORPUS: BenchmarkCase[] = [
  // === Pharmacology ===
  {
    id: 'PHARM-001',
    category: 'pharmacology',
    query: 'Quelles sont les interactions entre le curcuma (curcumine) et les anticoagulants oraux ? Existe-t-il des données sur les doses seuils de risque ?',
    expectedTopics: ['interaction curcumine-warfarine', 'inhibition CYP', 'effet antiplaquettaire', 'dose-réponse', 'cas cliniques rapportés'],
    difficultyLevel: 'moderate',
    requiresTransversality: true,
    requiresCuriosity: false,
  },
  {
    id: 'PHARM-002',
    category: 'pharmacology',
    query: 'Mécanisme d\'action du méthotrexate à faible dose dans la polyarthrite rhumatoïde : quelles sont les hypothèses actuelles sur son effet anti-inflammatoire au-delà de l\'inhibition du folate ?',
    expectedTopics: ['adénosine', 'voie JAK-STAT', 'inhibition NF-kB', 'effet sur les cytokines', 'rôle des polyglutamates'],
    difficultyLevel: 'complex',
    requiresTransversality: false,
    requiresCuriosity: true,
  },

  // === Nutrition ===
  {
    id: 'NUTR-001',
    category: 'nutrition',
    query: 'Efficacité du régime méditerranéen dans la prévention secondaire des maladies cardiovasculaires : méta-analyses récentes et niveau de preuve.',
    expectedTopics: ['PREDIMED', 'Lyon Diet Heart Study', 'réduction mortalité CV', 'composants clés', 'mécanismes anti-inflammatoires'],
    difficultyLevel: 'simple',
    requiresTransversality: true,
    requiresCuriosity: false,
  },
  {
    id: 'NUTR-002',
    category: 'nutrition',
    query: 'Le jeûne intermittent a-t-il un effet démontré sur la résistance à l\'insuline chez les patients diabétiques de type 2 ? Quels sont les risques ?',
    expectedTopics: ['autophagie', 'sensibilité insuline', 'HbA1c', 'risque hypoglycémie', 'observance', 'RCTs existants'],
    difficultyLevel: 'moderate',
    requiresTransversality: true,
    requiresCuriosity: true,
  },

  // === Rare Diseases ===
  {
    id: 'RARE-001',
    category: 'rare_disease',
    query: 'Syndrome de Ehlers-Danlos hypermobile : quelles sont les options thérapeutiques actuelles pour la douleur chronique, et quels traitements sont en cours d\'évaluation ?',
    expectedTopics: ['physiothérapie', 'gestion douleur', 'dysautonomie associée', 'essais cliniques en cours', 'collagène', 'comorbidités'],
    difficultyLevel: 'complex',
    requiresTransversality: true,
    requiresCuriosity: true,
  },

  // === Traditional Medicine ===
  {
    id: 'TRAD-001',
    category: 'traditional_medicine',
    query: 'L\'artemisia annua (armoise annuelle) : de l\'usage traditionnel chinois au traitement du paludisme. Quel est le niveau de preuve pour d\'autres applications thérapeutiques ?',
    expectedTopics: ['artémisinine', 'Tu Youyou', 'paludisme', 'activité anticancéreuse', 'propriétés anti-inflammatoires', 'usage traditionnel Qinghao'],
    difficultyLevel: 'complex',
    requiresTransversality: true,
    requiresCuriosity: true,
  },

  // === Multi-system ===
  {
    id: 'MULTI-001',
    category: 'multi_system',
    query: 'Lien entre microbiote intestinal et dépression : état des connaissances sur l\'axe intestin-cerveau et implications thérapeutiques.',
    expectedTopics: ['axe intestin-cerveau', 'nerf vague', 'sérotonine intestinale', 'probiotiques psychobiotiques', 'transplantation fécale', 'inflammation systémique'],
    difficultyLevel: 'complex',
    requiresTransversality: true,
    requiresCuriosity: true,
  },

  // === Controversial ===
  {
    id: 'CONTR-001',
    category: 'controversial',
    query: 'L\'homéopathie a-t-elle une efficacité démontrée au-delà de l\'effet placebo ? Que disent les méta-analyses les plus récentes et les plus rigoureuses ?',
    expectedTopics: ['effet placebo', 'méta-analyses Shang', 'méta-analyses Mathie', 'dilutions au-delà Avogadro', 'biais publication', 'position des autorités sanitaires'],
    difficultyLevel: 'moderate',
    requiresTransversality: true,
    requiresCuriosity: false,
  },

  // === Emerging Research ===
  {
    id: 'EMER-001',
    category: 'emerging_research',
    query: 'Thérapie par cellules CAR-T dans les tumeurs solides : quels sont les obstacles actuels et les approches prometteuses pour les surmonter ?',
    expectedTopics: ['microenvironnement tumoral', 'épuisement T-cell', 'antigènes cibles solides', 'combinaison checkpoint', 'armored CAR-T', 'essais cliniques récents'],
    difficultyLevel: 'complex',
    requiresTransversality: false,
    requiresCuriosity: true,
  },
  {
    id: 'EMER-002',
    category: 'emerging_research',
    query: 'Sémaglutide et effets extra-glycémiques : quels sont les effets cardiovasculaires, rénaux et neurologiques documentés au-delà du contrôle glycémique ?',
    expectedTopics: ['SUSTAIN-6', 'SELECT', 'néphroprotection', 'effets neurologiques', 'perte de poids', 'GLP-1 et inflammation'],
    difficultyLevel: 'moderate',
    requiresTransversality: false,
    requiresCuriosity: true,
  },
];
