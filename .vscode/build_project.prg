* Compila un proyecto .pjx pasado como par metro.
* Uso (desde tasks.json): DO build_project.prg WITH "C:\ruta\proyecto.pjx"

LPARAMETERS tcProjectPath

IF EMPTY(tcProjectPath) OR NOT FILE(tcProjectPath)
   ? "ERROR: Ruta de proyecto no v lida: " + IIF(EMPTY(tcProjectPath), "(vac a)", tcProjectPath)
   QUIT
ENDIF

? "Compilando proyecto: " + tcProjectPath

TRY
   MODIFY PROJECT (tcProjectPath) NOSHOW
   BUILD APP (FORCEEXT(tcProjectPath, "app")) FROM (tcProjectPath) RECOMPILE
   ? "Compilaci n completada."
CATCH TO loErr
   ? "ERROR en compilaci n: " + loErr.Message
ENDTRY

QUIT
