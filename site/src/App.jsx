import Hero from './sections/Hero.jsx'
import Advert from './sections/Advert.jsx'
import Apps from './sections/Apps.jsx'
import Start from './sections/Start.jsx'
import Switcher from './sections/Switcher.jsx'
import Files from './sections/Files.jsx'
import Storage from './sections/Storage.jsx'
import Cinema from './sections/Cinema.jsx'
import News from './sections/News.jsx'
import Notes from './sections/Notes.jsx'
import SettingsSection from './sections/SettingsSection.jsx'
import Personalise from './sections/Personalise.jsx'
import Details from './sections/Details.jsx'
import WindowsSection from './sections/WindowsSection.jsx'
import Private from './sections/Private.jsx'
import Early from './sections/Early.jsx'
import { useDocumentTitle } from './title.js'

export default function App() {
  useDocumentTitle('Udaan · Your desktop, rebuilt')
  return (
    <>
      <Hero />
      <Advert />
      <Apps />
      <Start />
      <Switcher />
      <Files />
      <Storage />
      <Cinema />
      <News />
      <Notes />
      <SettingsSection />
      <Personalise />
      <Details />
      <WindowsSection />
      <Private />
      <Early />
    </>
  )
}
