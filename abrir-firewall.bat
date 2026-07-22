netsh advfirewall firewall delete rule name="Golpeado 3080"
netsh advfirewall firewall add rule name="Golpeado 3080" dir=in action=allow protocol=TCP localport=3080 profile=any
netsh advfirewall firewall show rule name="Golpeado 3080"
pause
