package com.taskr.core;

import com.taskr.core.model.TaskTemplate;
import com.taskr.core.model.User;
import com.taskr.core.storage.TaskStorage;
import com.taskr.core.storage.TaskTemplateStorage;

import com.taskr.core.storage.UserStorage;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Component
public class Populator implements CommandLineRunner {

    UserStorage userStorage;
    TaskTemplateStorage taskTemplateStorage;
    TaskStorage taskStorage;
    ResourceManager resourceManager;

    public Populator(UserStorage userStorage, TaskTemplateStorage taskTemplateStorage, TaskStorage taskStorage, ResourceManager resourceManager) {
        this.userStorage = userStorage;
        this.taskTemplateStorage = taskTemplateStorage;
        this.taskStorage = taskStorage;
        this.resourceManager = resourceManager;
    }

    @Override
    public void run(String... args) throws Exception {
//        User testUser = new User("Test User", 600, "grey", "test.ico");
//        userStorage.save(testUser);

        TaskTemplate finalProjectDemo = new TaskTemplate("Final Project Demo", "Finishing the Demo", 300, "Tuesday");
        taskTemplateStorage.save(finalProjectDemo);

        User mom = new User("Mom", 300, "rose", "/front-end/images/mom.png");
        User dad = new User("Dad", 600, "apple", "/front-end/images/Dad.png");
        User bro = new User("Bro", 200, "light-blue", "/front-end/images/Bro.png");
        User sis = new User("Sis", 200, "magenta", "/front-end/images/sis.png");

//        userStorage.save(testUser);
        userStorage.save(mom);
        userStorage.save(dad);
        userStorage.save(bro);
        userStorage.save(sis);



        TaskTemplate cleanCommonArea = new TaskTemplate("Clean Common Area", "Clean all common areas", 30, 30, "Monday");
        TaskTemplate cleanGarage = new TaskTemplate("Clean Garage", "Sweep and organize the Garage", 45, 45, "Tuesday");
        TaskTemplate cleanBathrooms = new TaskTemplate("Clean Bathrooms", "Wipe down sinks, scrub toilets, sweep and mop floors, and empty bathroom trash", 30, 30, "Wednesday");
        TaskTemplate takeOutTrash = new TaskTemplate("Take Out Trash", "Take all trash to rolling bin outside and take the rolling bin to the road if today is a trash day", 15,"Wednesday" );
        TaskTemplate washDishes = new TaskTemplate("Wash Dishes", "Wash and dry all dishes in the sink and empty/load the dishwasher", 30, "Wednesday");
        TaskTemplate washAndDryLaundry = new TaskTemplate("Wash and Dry Laundry", "", 30, 200, "Monday");
        TaskTemplate foldAndPutAwayLaundry = new TaskTemplate("Fold and Put Away Laundry", "", 30, "Monday");
        TaskTemplate rakeLeaves = new TaskTemplate("Rake Leaves", "Rake and bag the leaves from the front, back, and sides of the house", 45, "Monday");
        TaskTemplate mowLawn = new TaskTemplate("Mow Lawn", "Pick up rocks and sticks in the yards and mow the front and back lawn", 45, "Monday");
        TaskTemplate cleanBedroom = new TaskTemplate("Clean Bedroom", "Clean your room", 30, "Tuesday");
        TaskTemplate deepCleanKitchen = new TaskTemplate("Deep Clean Kitchen", "Clear off and wipe down all counter tops, wipe cabinet fronts, wipe behind sink, wipe trim boards under cabinets, sweep, and mop kitchen", 90, "Tuesday");
        TaskTemplate tidyKitchen = new TaskTemplate("Tidy Kitchen", "Move dishes to sink, wipe down counter tops and table, and sweep floors", 30, "Tuesday");
        TaskTemplate vacuumLivingRoom = new TaskTemplate("Vacuum Living Room", "Vacuum floors, crevases, and under furniture, and remove couch cushions to vacuum under cushions", 30, "Tuesday");
        TaskTemplate mopAndSweepKitchen = new TaskTemplate("Mop and Sweep Kitchen", "Sweep and hot mop the kitchen floors", 30, "Thursday");
        TaskTemplate changeLitterBox = new TaskTemplate("Change Litter Box", "Scoop the litter box and replace the litter if today is Friday", 15, "Thursday");
        TaskTemplate walkDog = new TaskTemplate("Walk Dog", "Take the dogs for a walk around the block", 20, "Daily");
        TaskTemplate cleanUpYard = new TaskTemplate("Clean Up Yard", "Pick up sticks and rocks in the front and back yard and pick up any trash that has blown in", 20, "Thursday");
        TaskTemplate getMail = new TaskTemplate("Get Mail", "Get the mail from the mailbox", 5, "Daily");
        TaskTemplate dustLivingRoom = new TaskTemplate("Dust Living Room", "Dust picture frames, end tables, coffee table, and door sills in the living room", 20, "Friday");
        TaskTemplate dustFamilyRoom = new TaskTemplate("Dust Family Room", "Dust bookshelves, mantel over fireplace, stereo, and door sills in family room", 20, "Friday");
        TaskTemplate vacuumFamilyRoom = new TaskTemplate("Vacuum Family Room", "Vacuum floors, crevases, and under furniture in the family room", 20, "Friday");
        TaskTemplate dustCeilingFans = new TaskTemplate("Dust Ceiling Fans", "Wipe blades of ceiling fans down and ensure dust is blown out of fan motor housing", 30, "Friday", bro, sis);

        taskTemplateStorage.save(cleanCommonArea);
        taskTemplateStorage.save(cleanGarage);
        taskTemplateStorage.save(cleanBathrooms);
        taskTemplateStorage.save(takeOutTrash);
        taskTemplateStorage.save(washDishes);
        taskTemplateStorage.save(washAndDryLaundry);
        taskTemplateStorage.save(foldAndPutAwayLaundry);
        taskTemplateStorage.save(rakeLeaves);
        taskTemplateStorage.save(mowLawn);
        taskTemplateStorage.save(cleanBedroom);
        taskTemplateStorage.save(deepCleanKitchen);
        taskTemplateStorage.save(tidyKitchen);
        taskTemplateStorage.save(vacuumLivingRoom);
        taskTemplateStorage.save(mopAndSweepKitchen);
        taskTemplateStorage.save(changeLitterBox);
        taskTemplateStorage.save(walkDog);
        taskTemplateStorage.save(cleanUpYard);
        taskTemplateStorage.save(getMail);
        taskTemplateStorage.save(dustLivingRoom);
        taskTemplateStorage.save(dustFamilyRoom);
        taskTemplateStorage.save(vacuumFamilyRoom);
        taskTemplateStorage.save(dustCeilingFans);

        resourceManager.allocateAllTasks();

    }


}
