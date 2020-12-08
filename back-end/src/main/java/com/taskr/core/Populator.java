package com.taskr.core;

import com.taskr.core.Resources.TaskTemplate;
import com.taskr.core.Resources.User;
import com.taskr.core.storages.TaskStorage;
import com.taskr.core.storages.TaskTemplateStorage;

import com.taskr.core.storages.UserStorage;
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
//    this is just to make sure I can commit

    @Override
    public void run(String... args) throws Exception {
        User testUser = new User("Test User", 600, "grey", "test.ico");
        userStorage.save(testUser);

        TaskTemplate testTemplate = new TaskTemplate("Final Project Demo", "", 300);
        taskTemplateStorage.save(testTemplate);

        User mom = new User("Mom", 300, "pink", "mom.ico");
        User dad = new User("Dad", 600, "green", "dad.ico");
        User bro = new User("Bro", 200, "blue", "bro.ico");
        User sis = new User("Sis", 200, "purple", "sis.ico");

        userStorage.save(testUser);
        userStorage.save(mom);
        userStorage.save(dad);
        userStorage.save(bro);
        userStorage.save(sis);

//        Date dueDate = new Date(1607576400000L);
//        Task testTask = new Task(testUser, testTemplate);
//        testTask.setDueBy(dueDate);
//        testTask.setDescription("Test Task");
//        taskStorage.save(testTask);
//        userStorage.updateUser(testUser);
//        userStorage.save(testUser);
        TaskTemplate cleanCommonArea = new TaskTemplate("Clean Common Area", "Clean all common areas", 30, 30);
        TaskTemplate newTasktemplate02 = new TaskTemplate("Clean Garage", "Sweep and organize the Garage", 45, 45);
        TaskTemplate newTasktemplate03 = new TaskTemplate("Clean Bathrooms", "Wipe down sinks, scrub toilets, sweep and mop floors, and empty bathroom trash", 30, 30);
        TaskTemplate newTasktemplate04 = new TaskTemplate("Take Out Trash", "Take all trash to rolling bin outside and take the rolling bin to the road if today is a trash day", 15);
        TaskTemplate newTasktemplate05 = new TaskTemplate("Wash Dishes", "Wash and dry all dishes in the sink and empty/load the dishwasher", 30);
        TaskTemplate newTasktemplate06 = new TaskTemplate("Wash/Dry Laundry", "", 30, 200);
        TaskTemplate newTasktemplate07 = new TaskTemplate("Fold/Put Away Laundry", "", 30);
        TaskTemplate newTasktemplate08 = new TaskTemplate("Rake Leaves", "Rake and bag the leaves from the front, back, and sides of the house", 45);
        TaskTemplate newTasktemplate09 = new TaskTemplate("Mow Lawn", "Pick up rocks and sticks in the yards and mow the front and back lawn", 45);
        TaskTemplate newTasktemplate10 = new TaskTemplate("Clean Bedroom", "Clean your room", 30);
        TaskTemplate newTasktemplate11 = new TaskTemplate("Deep Clean Kitchen", "Clear off and wipe down all counter tops, wipe cabinet fronts, wipe behind sink, wipe trim boards under cabinets, sweep, and mop kitchen", 90);
        TaskTemplate newTasktemplate12 = new TaskTemplate("Tidy Kitchen", "Move dishes to sink, wipe down counter tops and table, and sweep floors", 30);
        TaskTemplate newTasktemplate13 = new TaskTemplate("Vacuum Living Room", "Vacuum floors, crevases, and under furniture, and remove couch cushions to vacuum under cushions", 30);
        TaskTemplate newTasktemplate14 = new TaskTemplate("Mop/Sweep Kitchen", "Sweep and hot mop the kitchen floors", 30);
        TaskTemplate newTasktemplate15 = new TaskTemplate("Change Litter Box", "Scoop the litter box and replace the litter if today is Friday", 15);
        TaskTemplate newTasktemplate16 = new TaskTemplate("Walk Dog", "Take the dogs for a walk around the block", 20);
        TaskTemplate newTasktemplate17 = new TaskTemplate("Clean Up Yard", "Pick up sticks and rocks in the front and back yard and pick up any trash that has blown in", 20);
        TaskTemplate newTasktemplate18 = new TaskTemplate("Get Mail", "Get the mail from the mailbox", 5);
        TaskTemplate newTasktemplate19 = new TaskTemplate("Dust Living Room", "Dust picture frames, end tables, coffee table, and door sills in the living room", 20);
        TaskTemplate newTasktemplate20 = new TaskTemplate("Dust Family Room", "Dust bookshelves, mantel over fireplace, stereo, and door sills in family room", 20);
        TaskTemplate newTasktemplate21 = new TaskTemplate("Vacuum Family Room", "Vacuum floors, crevases, and under furniture in the family room", 20);
        TaskTemplate newTasktemplate22 = new TaskTemplate("Dust Ceiling Fans", "Wipe blades of ceiling fans down and ensure dust is blown out of fan motor housing", 30, bro, sis);

        taskTemplateStorage.save(cleanCommonArea);
        taskTemplateStorage.save(newTasktemplate02);
        taskTemplateStorage.save(newTasktemplate03);
        taskTemplateStorage.save(newTasktemplate04);
        taskTemplateStorage.save(newTasktemplate05);
        taskTemplateStorage.save(newTasktemplate06);
        taskTemplateStorage.save(newTasktemplate07);
        taskTemplateStorage.save(newTasktemplate08);
        taskTemplateStorage.save(newTasktemplate09);
        taskTemplateStorage.save(newTasktemplate10);
        taskTemplateStorage.save(newTasktemplate11);
        taskTemplateStorage.save(newTasktemplate12);
        taskTemplateStorage.save(newTasktemplate13);
        taskTemplateStorage.save(newTasktemplate14);
        taskTemplateStorage.save(newTasktemplate15);
        taskTemplateStorage.save(newTasktemplate16);
        taskTemplateStorage.save(newTasktemplate17);
        taskTemplateStorage.save(newTasktemplate18);
        taskTemplateStorage.save(newTasktemplate19);
        taskTemplateStorage.save(newTasktemplate20);
        taskTemplateStorage.save(newTasktemplate21);
        taskTemplateStorage.save(newTasktemplate22);

//        HashSet<TaskTemplate> taskTemplateIterable = new HashSet<>();
//        taskTemplateIterable.add(newTasktemplate01);
//        taskTemplateStorage.allocateSingleTask(newTasktemplate01);
//        taskTemplateStorage.allocateTasks(taskTemplateIterable);
        resourceManager.allocateAllTasks();
//
//
//
//
//        Task newTask1 = new Task(testUser1, newTasktemplate01);
//        Task newTask2 = new Task(testUser1, testTemplate2);
//        Task newTask3 = new Task(testUser2, newTasktemplate22);
//        Task newTask4 = new Task(testUser3, testTemplate3);
//        Task newTask5 = new Task(testUser4, testTemplate1);
//        Task newTask6 = new Task(testUser1, testTemplate4);
//        Task newTask7 = new Task(testUser2, testTemplate1);
//        Task newTask8 = new Task(testUser3, newTasktemplate20);
//        Task newTask9 = new Task(testUser3, testTemplate1);
//        Task newTask10 = new Task(testUser4, testTemplate1);
//        Task newTask11 = new Task(testUser1, testTemplate1);
//        Task newTask12 = new Task(testUser2, testTemplate1);
//        Task newTask13 = new Task(testUser3, testTemplate1);
//        Task newTask14 = new Task(testUser4, testTemplate1);
//        Task newTask15 = new Task(testUser3, testTemplate1);
//        Task aNewTask0 = new Task(testUser1, newTasktemplate01);
//        Task aNewTask1 = new Task(testUser1, newTasktemplate02);
//        Task aNewTask2 = new Task(testUser1, newTasktemplate03);
//        Task aNewTask3 = new Task(testUser1, newTasktemplate04);
//        Task aNewTask4 = new Task(testUser1, newTasktemplate05);
//        Task aNewTask5 = new Task(testUser1, newTasktemplate06);
//        Task aNewTask6 = new Task(testUser1, newTasktemplate07);
//        Task aNewTask7 = new Task(testUser1, newTasktemplate08);
//        Task aNewTask8 = new Task(testUser1, newTasktemplate09);
//        Task aNewTask9 = new Task(testUser1, newTasktemplate10);
//        Task aNewTask10 = new Task(testUser2, newTasktemplate01);
//        Task aNewTask11 = new Task(testUser2, newTasktemplate02);
//        Task aNewTask12 = new Task(testUser2, newTasktemplate03);
//        Task aNewTask13 = new Task(testUser2, newTasktemplate04);
//        Task aNewTask14 = new Task(testUser2, newTasktemplate05);
//        Task aNewTask15 = new Task(testUser2, newTasktemplate06);
//        Task aNewTask16 = new Task(testUser2, newTasktemplate07);
//        Task aNewTask17 = new Task(testUser2, newTasktemplate08);
//        Task aNewTask18 = new Task(testUser2, newTasktemplate09);
//        Task aNewTask19 = new Task(testUser2, newTasktemplate10);
//        Task aNewTask20 = new Task(testUser3 ,newTasktemplate10);
//        Task aNewTask21 = new Task(testUser3 ,newTasktemplate11);
//        Task aNewTask22 = new Task(testUser3 ,newTasktemplate12);
//        Task aNewTask23 = new Task(testUser3 ,newTasktemplate13);
//        Task aNewTask24 = new Task(testUser3 ,newTasktemplate14);
//        Task aNewTask25 = new Task(testUser3 ,newTasktemplate15);
//        Task aNewTask26 = new Task(testUser3 ,newTasktemplate16);
//        Task aNewTask27 = new Task(testUser3 ,newTasktemplate17);
//        Task aNewTask28 = new Task(testUser3 ,newTasktemplate18);
//        Task aNewTask29 = new Task(testUser3 ,newTasktemplate19);
//        Task aNewTask30 = new Task(testUser4, newTasktemplate10);
//        Task aNewTask31 = new Task(testUser4, newTasktemplate11);
//        Task aNewTask32 = new Task(testUser4, newTasktemplate12);
//        Task aNewTask33 = new Task(testUser4, newTasktemplate13);
//        Task aNewTask34 = new Task(testUser4, newTasktemplate14);
//        Task aNewTask35 = new Task(testUser4, newTasktemplate15);
//        Task aNewTask36 = new Task(testUser4, newTasktemplate16);
//        Task aNewTask37 = new Task(testUser4, newTasktemplate17);
//        Task aNewTask38 = new Task(testUser4, newTasktemplate18);
//        Task aNewTask39 = new Task(testUser4, newTasktemplate19);
//        Task aNewTask40 = new Task(testUser, newTasktemplate21);
//
//        taskStorage.save(aNewTask0);
//        taskStorage.save(aNewTask1);
//        taskStorage.save(aNewTask2);
//        taskStorage.save(aNewTask3);
//        taskStorage.save(aNewTask4);
//        taskStorage.save(aNewTask5);
//        taskStorage.save(aNewTask6);
//        taskStorage.save(aNewTask7);
//        taskStorage.save(aNewTask8);
//        taskStorage.save(aNewTask9);
//        taskStorage.save(aNewTask10);
//        taskStorage.save(aNewTask11);
//        taskStorage.save(aNewTask12);
//        taskStorage.save(aNewTask13);
//        taskStorage.save(aNewTask14);
//        taskStorage.save(aNewTask15);
//        taskStorage.save(aNewTask16);
//        taskStorage.save(aNewTask17);
//        taskStorage.save(aNewTask18);
//        taskStorage.save(aNewTask19);
//        taskStorage.save(aNewTask20);
//        taskStorage.save(aNewTask21);
//        taskStorage.save(aNewTask22);
//        taskStorage.save(aNewTask23);
//        taskStorage.save(aNewTask24);
//        taskStorage.save(aNewTask25);
//        taskStorage.save(aNewTask26);
//        taskStorage.save(aNewTask27);
//        taskStorage.save(aNewTask28);
//        taskStorage.save(aNewTask29);
//        taskStorage.save(aNewTask30);
//        taskStorage.save(aNewTask31);
//        taskStorage.save(aNewTask32);
//        taskStorage.save(aNewTask33);
//        taskStorage.save(aNewTask34);
//        taskStorage.save(aNewTask35);
//        taskStorage.save(aNewTask36);
//        taskStorage.save(aNewTask37);
//        taskStorage.save(aNewTask38);
//        taskStorage.save(aNewTask39);
//        taskStorage.save(aNewTask40);

//        userStorage.save(testUser);
//        userStorage.save(testUser1);
//        userStorage.save(testUser2);
//        userStorage.save(testUser3);
//        userStorage.save(testUser4);


    }


}
