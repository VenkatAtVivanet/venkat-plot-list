function populate(s1,s2)
{
    var s1 = document.getElementById(s1);
    var s2 = document.getElementById(s2);
    s2.innerHTML = "";
    if(s1.value == "All Areas")
    {
        var optionArray =["All Localities"];
    }
    else if(s1.value == "Hyderabad")
    {
        var optionArray = ["All Localities","Secunderabad","Kukatpally","Hi-Tech City"];
    } 
    else if(s1.value == "Pune")
    {
        var optionArray = ["All Localities","Hinjewadi","Wakad","Balewadi"];
    } 
    else if(s1.value == "Mumbai")
    {
        var optionArray = ["All Localities","Bandra","Dharavi","Chowpatty"];
    }
    for(var option in optionArray)
    {
        var opt = optionArray[option];
        var newOption = document.createElement("option");
        newOption.innerHTML = opt;
        s2.options.add(newOption);
    }
}