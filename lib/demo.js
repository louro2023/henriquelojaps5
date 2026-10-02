const titles = [
  ['Cyberpunk 2077', 'RPG', '1091500', 'Night City está esperando por você. Explore uma metrópole onde suas escolhas mudam tudo.'],
  ['God of War', 'Ação e aventura', '1593500', 'Uma jornada épica por terras nórdicas ao lado de Kratos e Atreus.'],
  ['Forza Horizon 5', 'Corrida', '1551360', 'Descubra paisagens incríveis em uma aventura automobilística de mundo aberto.'],
  ['Hogwarts Legacy', 'RPG', '990080', 'Viva sua própria história em um mundo repleto de magia e descobertas.'],
  ['Red Dead Redemption 2', 'Ação e aventura', '1174180', 'Explore o velho oeste em uma história inesquecível.'],
  ['Hollow Knight', 'Indie', '367520', 'Desvende um reino subterrâneo em uma aventura desenhada à mão.'],
];

export const demoGames = titles.map(([title, category, app, description], index) => ({
  id: index + 1, title, category, platform: 'PC', description,
  cover: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${app}/header.jpg`,
  driveUrl: '', instructions: '', published: true, featured: app === '1091500', demo: true,
}));
